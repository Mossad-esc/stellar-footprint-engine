module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['api', 'services', 'middleware', 'config', 'utils', 'docs', 'infra', 'tests', 'dx'],
    ],
  },
};
