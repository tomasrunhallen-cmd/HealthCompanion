// B1: the core's test cases on every platform the app runs on (web, Node, iOS, Android).
const universal = require('jest-expo/universal/jest-preset');
const ignore = ['node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|@noble/.*)'];

module.exports = {
  ...universal,
  projects: universal.projects.map((p) => ({ ...p, testMatch: ['<rootDir>/tests/core/**/*.test.ts'], transformIgnorePatterns: ignore })),
};
