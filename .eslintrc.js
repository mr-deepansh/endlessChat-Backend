export default {
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  extends: [
    "eslint:recommended",
    "airbnb-base",
    "plugin:security/recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:prettier/recommended",
  ],
  plugins: ["security", "import", "node", "prettier"],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  rules: {
    "prettier/prettier": "error",
    indent: "off",
    quotes: "off",
    semi: "off",
    "comma-dangle": "off",
    "object-curly-spacing": "off",
    "array-bracket-spacing": "off",
    "max-len": "off",
    "no-console": process.env.NODE_ENV === "production" ? "error" : "warn",
    "no-debugger": process.env.NODE_ENV === "production" ? "error" : "warn",
    "no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
    "security/detect-object-injection": "error",
    "security/detect-unsafe-regex": "error",
    "security/detect-eval-with-expression": "error",
    "security/detect-child-process": "warn",
    "security/detect-non-literal-fs-filename": "warn",
    "node/no-deprecated-api": "error",
    "node/prefer-global/process": ["error", "always"],
    "node/prefer-promises/fs": "error",
    "no-underscore-dangle": [
      "error",
      {
        allow: ["_id", "__dirname", "__filename", "_"],
      },
    ],
    "consistent-return": "off",
    "class-methods-use-this": "off",
    "func-names": "off",
    complexity: ["warn", 10],
    "max-depth": ["warn", 4],
  },
  settings: {
    "import/resolver": {
      node: {
        extensions: [".js", ".json", ".mjs"],
      },
    },
  },
  ignorePatterns: ["node_modules/", "dist/", "build/", "logs/", "coverage/"],
};
