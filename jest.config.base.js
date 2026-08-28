const path = require('node:path')

module.exports = {
	roots: ['<rootDir>/src'],
	projects: ['<rootDir>'],
	preset: 'ts-jest',
	moduleFileExtensions: ['js', 'ts'],
	transform: {
		'^.+\\.(ts|tsx)$': [
			'ts-jest',
			{
				tsconfig: path.join(__dirname, 'tsconfig.jest.json'),
				diagnostics: {
					ignoreCodes: [
						151002, // hybrid module kind (Node16/18/Next)
					],
				},
			},
		],
		'^.+\\.js$': ['ts-jest', { tsconfig: path.join(__dirname, 'tsconfig.jest.json') }],
	},
	testMatch: ['**/__tests__/**/*.spec.(ts|js)'],
	testEnvironment: 'node',
	transformIgnorePatterns: [
		'node_modules/(?!(p-queue|p-timeout|@sofie-automation/shared-lib|@sofie-automation/server-core-integration)/)',
	], // This is not pretty, but required for any esm dependencies
	coverageThreshold: {
		global: {
			branches: 100,
			functions: 100,
			lines: 100,
			statements: 100,
		},
	},
	coverageDirectory: '<rootDir>/coverage/',
	collectCoverage: false,
	// verbose: true,
}
