const React = require('react');
const { View } = require('react-native');

function PerformanceOverlay() {
  return React.createElement(View, { style: { height: 0 } });
}

module.exports = {
  default: PerformanceOverlay
};
