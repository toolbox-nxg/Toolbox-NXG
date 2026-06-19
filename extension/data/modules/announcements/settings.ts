/**
 * Setting definitions for the Announcements module.
 *
 * Intentionally empty: the module has no user-configurable options, and an empty
 * settings list keeps it out of the Toolbox Settings dialog (which only renders a
 * tab for modules that have at least one visible setting).
 */
import {defineSettings, type InferSettings,} from '../../framework/module'

export const settings = defineSettings([],)

export type AnnouncementsSettings = InferSettings<typeof settings>
