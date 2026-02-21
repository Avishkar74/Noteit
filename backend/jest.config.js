module.exports = {
  testEnvironment: 'node',
  testTimeout: 15000,
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.js'],
  coverageThreshold: {
    global: {
      lines: 70,
      functions: 70,
      statements: 70,
    },
  },
  verbose: true,
};
