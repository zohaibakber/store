module.exports = function configureBabel(api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: ["@babel/plugin-transform-async-generator-functions"],
  };
};
