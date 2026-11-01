// B4: the day-and-time tests, run once per time zone (see "test" in package.json).
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/tz/*.tz.ts'],
  transformIgnorePatterns: ['node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|@noble/.*)'],
};
