const { getSentryExpoConfig } = require("@sentry/react-native/metro");

module.exports = getSentryExpoConfig(__dirname, {
  autoWrapExpoRouterErrorBoundary: true,
  includeWebReplay: false,
  includeWebFeedback: false,
});
