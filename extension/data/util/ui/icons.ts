/**
 * Lookup table from friendly Toolbox icon names to their Material Symbols glyph
 * code points. These code points target the bundled `MaterialSymbols-Filled.woff2`
 * subset; several differ from the legacy Material Icons values for the same
 * ligature. Prefer rendering these through the `<Icon>` component - e.g.
 * `<Icon icon="delete" />` - rather than using the code points directly.
 */
export const icons = {
	add: '\ue145', // add
	addBox: '\ue146', // add_box
	addCircle: '\ue990', // add_circle_outline
	archive: '\ue149', // archive
	unarchive: '\ue169', // unarchive
	arrowLeft: '\ue314', // keyboard_arrow_left
	arrowRight: '\ue315', // keyboard_arrow_right
	ban: '\uf08c', // block
	close: '\ue5cd', // close
	comments: '\ue0c9', // chat
	delete: '\ue92e', // delete
	dotMenu: '\ue5d4', // more_vert
	dragHandle: '\ue945', // drag_indicator
	edit: '\uf097', // edit
	flair: '\ue893', // label
	help: '\ue8fd', // help_outline
	history: '\ue8b3', // history
	list: '\ue896', // list
	modlog: '\ue3ec', // grid_on
	modqueue: '\uf083', // report_problem
	modmail: '\ue156', // inbox
	mute: '\ue7f6', // notifications_off
	overlay: '\ue8ea', // view_array
	profile: '\uf20b', // account_circle
	refresh: '\ue5d5', // refresh
	remove: '\ue15b', // remove
	settings: '\ue8b8', // settings
	sortDown: '\ue5db', // arrow_downward
	sortUp: '\ue5d8', // arrow_upward
	subTraffic: '\ue6e1', // show_chart
	tbConsole: '\ue868', // bug_report
	tbReload: '\ue86a', // cached
	tbSettingLink: '\ue250', // link
	tbSubConfig: '\uf8cd', // build
	unmoderated: '\ue8f4', // remove_red_eye
	userInbox: '\ue159', // email
	usernote: '\ue674', // note
	prerelease: '\ue86f', // code
	unknownDocument: '\uf804', // unknown_document
	trainingMode: '\ue80c', // school
}
