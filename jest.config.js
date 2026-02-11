module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup.js'],
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/vendor/',
    '/tests/'
  ],
  collectCoverageFrom: [
    'extension/lib/**/*.js',
    'backend/src/**/*.js'
  ],
  verbose: true
};
