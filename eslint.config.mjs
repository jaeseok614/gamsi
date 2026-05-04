import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  {
    ignores: [
      ".codex/**",
      ".next/**",
      "backups/**",
      "coverage/**",
      "data/uploads/**",
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "src/generated/**",
      "test-results/**"
    ]
  }
];

export default eslintConfig;
