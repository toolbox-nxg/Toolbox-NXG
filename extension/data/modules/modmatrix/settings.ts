/** Settings definitions and inferred type for the Mod Log Matrix module (currently no user-facing settings). */

import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings([] as const,)

/** Inferred settings type for the Mod Log Matrix module. */
export type ModMatrixSettings = InferSettings<typeof settings>
