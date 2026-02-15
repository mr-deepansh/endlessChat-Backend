export default {
  useTabs: false,
  tabWidth: 2,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: "always",
  printWidth: 120,
  proseWrap: "preserve",
  endOfLine: "lf",
  insertPragma: false,
  requirePragma: false,
  overrides: [
    {
      files: ["*.json", "*.yml", "*.yaml"],
      options: {
        tabWidth: 2,
      },
    },
    {
      files: "*.md",
      options: {
        proseWrap: "always",
      },
    },
  ],
};
