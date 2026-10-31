import {definePlugin} from '@oxlint/plugins'

import {moduleBoundaries} from './rules/module-boundaries.ts'
import {noFixtureAssertion} from './rules/no-fixture-assertion.ts'
import {noHardcodedColors} from './rules/no-hardcoded-colors.ts'
import {noRscDirectives} from './rules/no-rsc-directives.ts'
import {shadcnBaseUi} from './rules/shadcn-base-ui.ts'
import {tsxUnderUi} from './rules/tsx-under-ui.ts'

const plugin = definePlugin({
  meta: {name: 'uz'},
  rules: {
    'module-boundaries': moduleBoundaries,
    'no-fixture-assertion': noFixtureAssertion,
    'no-hardcoded-colors': noHardcodedColors,
    'no-rsc-directives': noRscDirectives,
    'shadcn-base-ui': shadcnBaseUi,
    'tsx-under-ui': tsxUnderUi,
  },
})

export default plugin
