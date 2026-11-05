const argon2 = require("argon2");
const authRepository = require("../repositories/authRepository");

function createAuthError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateCredentials(identifier, password) {
  if (
    typeof identifier !== "string" ||
    !identifier.trim() ||
    identifier.trim().length > 255 ||
    typeof password !== "string" ||
    !password ||
    password.length > 1024
  ) {
    throw createAuthError("Username/email and password are required.", 400);
  }

  return { identifier: identifier.trim(), password };
}

async function authenticate(identifier, password) {
  const credentials = validateCredentials(identifier, password);
  const users = await authRepository.findByIdentifier(credentials.identifier);

  if (users.length !== 1 || !users[0].is_active) {
    return null;
  }

  if (
    typeof users[0].password_hash !== "string" ||
    !users[0].password_hash.startsWith("$argon2id$")
  ) {
    return null;
  }

  let passwordMatches = false;
  try {
    passwordMatches = await argon2.verify(
      users[0].password_hash,
      credentials.password
    );
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
  }

  if (!passwordMatches) {
    return null;
  }

  const { id, username, email, role } = users[0];
  return { id, username, email, role };
}

async function getActiveUser(id) {
  return authRepository.findActiveById(id);
}

async function createInitialOwner({ username, email, password }) {
  if (
    typeof username !== "string" ||
    !username.trim() ||
    username.trim().length > 50 ||
    typeof email !== "string" ||
    !email.trim() ||
    email.trim().length > 255 ||
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 1024
  ) {
    throw createAuthError(
      "Username and email are required; the password must be 12 to 1024 characters.",
      400
    );
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
  });

  try {
    return await authRepository.createInitialOwner({
      username: username.trim(),
      email: email.trim(),
      passwordHash,
    });
  } catch (error) {
    if (error.code === "23505") {
      throw createAuthError("The username or email address is already in use.", 409);
    }
    throw error;
  }
}

module.exports = { authenticate, getActiveUser, createInitialOwner };
