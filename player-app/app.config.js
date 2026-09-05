const { createExpoConfig } = require('./release-config.cjs');

module.exports = ({ config }) => createExpoConfig(config, process.env);
