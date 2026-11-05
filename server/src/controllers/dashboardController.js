const dashboardService = require("../services/dashboardService");

async function getDashboard(req, res) {
  const dashboard = await dashboardService.getDashboard();

  res.status(200).json({
    status: "success",
    data: dashboard,
  });
}

module.exports = { getDashboard };
