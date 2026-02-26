import js from "@eslint/js"
import { defineConfig } from "eslint/config"
import importPlugin from 'eslint-plugin-import'
import globals from "globals"

export default defineConfig([
  js.configs.recommended,
  {
    files: [`src/**/*.js`],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: `module`,
      },
    },
    plugins: { import: importPlugin },
    rules: {
      "no-trailing-spaces": `error`,
      "array-bracket-spacing": [2,`never`],
      "arrow-parens": [`error`,`as-needed`],
      "arrow-spacing": `error`,
      "comma-dangle": [`error`,`always-multiline`],

      "comma-spacing": [`error`,{
        before: false,
        after: false,
      }],

      "computed-property-spacing": [`error`,`never`],
      curly: [`error`,`multi`],
      "guard-for-in": 1,

      indent: [`error`,2,{
        SwitchCase: 1,
        VariableDeclarator: 1,
      }],

      "key-spacing": [`error`,{ beforeColon: false }],

      "no-bitwise": 1,
      "no-console": `off`,
      "no-mixed-requires": [0,false],
      "no-mixed-spaces-and-tabs": [2],
      "no-multi-spaces": [`error`],
      "no-undef": [0],
      "no-unused-vars": [0],

      "object-curly-newline": [`error`,{
        multiline: true,
        minProperties: 7,
      }],

      "object-curly-spacing": [`error`,`always`],

      "object-property-newline": [`error`,{ allowAllPropertiesOnSameLine: true }],

      "object-shorthand": [`error`,`always`],
      quotes: [2,`backtick`],
      semi: [2,`never`],
      "space-before-function-paren": [`error`,`never`],
      "space-in-parens": [`error`,`never`],
      "space-infix-ops": [`error`],
      "vars-on-top": 0,

      "padding-line-between-statements": [`error`,{
        blankLine: `always`,
        prev: `function`,
        next: `function`,
      }],

      "import/order": [`error`,{
        "groups": [
          `builtin`,
          `external`,
          `internal`,
          [`parent`,`sibling`,`index`],
        ],
        "alphabetize": { order: `asc`,caseInsensitive: true },
        "newlines-between": `always`,
      }],
    },
  },
])