const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const servicePath = path.join(root, "server/src/services/reportService.js");
const originalLoad = Module._load;

function loadService(repository) {
  Module._load = function(request, parent, isMain) {
    if (request === "../repositories/reportRepository" && parent.filename === servicePath) {
      return repository;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[servicePath];
  try {
    return require(servicePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("report service normalizes valid date ranges before repository call", async () => {
  const calls = [];
  const service = loadService({
    async getReports(filters) {
      calls.push(filters);
      return { sales: { total_sales: "12.00" } };
    },
  });

  const result = await service.getReports({ from: "2026-11-01", to: "2026-11-05" });
  assert.deepEqual(result, { sales: { total_sales: "12.00" } });
  assert.deepEqual(calls, [{ from: "2026-11-01", to: "2026-11-05" }]);
});

test("report service allows no date range for all-time financial reports", async () => {
  const calls = [];
  const service = loadService({
    async getReports(filters) {
      calls.push(filters);
      return {};
    },
  });

  await service.getReports({});
  assert.deepEqual(calls, [{ from: null, to: null }]);
});

test("report service rejects invalid dates and reversed ranges", async () => {
  const service = loadService({
    async getReports() {
      throw new Error("The repository should not be called for invalid dates.");
    },
  });

  await assert.rejects(service.getReports({ from: "2026-02-29" }), { statusCode: 400 });
  await assert.rejects(service.getReports({ to: "November 5" }), { statusCode: 400 });
  await assert.rejects(
    service.getReports({ from: "2026-11-06", to: "2026-11-05" }),
    { statusCode: 400 }
  );
});
