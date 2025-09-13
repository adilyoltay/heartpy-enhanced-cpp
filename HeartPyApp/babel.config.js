module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Ensure worklets-core transforms are applied
    ['react-native-worklets-core/plugin'],
    // Reanimated plugin must be listed last
    'react-native-reanimated/plugin',
  ],
};
