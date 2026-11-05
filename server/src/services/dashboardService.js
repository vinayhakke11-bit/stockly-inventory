const dashboardRepository = require("../repositories/dashboardRepository");

async function getDashboard() {
  return dashboardRepository.getDashboard();
}

module.exports = { getDashboard };
