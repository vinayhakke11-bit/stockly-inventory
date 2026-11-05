const reportService = require("../services/reportService");

async function getReports(req, res) {
  const reports = await reportService.getReports(req.query);
  res.status(200).json({
    status: "success",
    data: reports,
  });
}

module.exports = { getReports };
