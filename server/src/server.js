const app = require("./app");
const { port } = require("./config/server");

app.listen(port, () => {
  console.log(`API server is listening on port ${port}`);
});
