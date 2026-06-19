/** Module settings definitions for the Support module (no configurable settings). */

import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings([] as const,)

/** Inferred settings type for the Support module. */
export type SupportSettings = InferSettings<typeof settings>
