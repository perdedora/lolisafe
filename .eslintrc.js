module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: 10 // 2019
  },
  env: {
    node: true
  },
  extends: [
    'standard'
  ],
  rules: {
    'object-shorthand': [
      'error',
      'always'
    ]
  }
}
