/** Tests for the expand-reports site-table class factory. */

import {beforeEach, describe, expect, it,} from 'vitest'

import {createExpandReportsHandlers, reportsExpandedClass,} from './expandReports'

describe('createExpandReportsHandlers', () => {
	beforeEach(() => {
		document.body.innerHTML = '<div id="siteTable" class="sitetable"></div>'
	},)

	/** Returns the fixture's site table, failing the test if it went missing. */
	function siteTable () {
		const element = document.querySelector('#siteTable',)
		if (!element) { throw new Error('fixture is missing #siteTable',) }
		return element
	}

	it('expands reports on the site table when the setting is on', () => {
		createExpandReportsHandlers({expandReports: true,},)

		expect(siteTable().classList.contains(reportsExpandedClass,),).toBe(true,)
	})

	it('leaves the site table alone when the setting is off', () => {
		createExpandReportsHandlers({expandReports: false,},)

		expect(siteTable().classList.contains(reportsExpandedClass,),).toBe(false,)
	})

	it('removes the class on cleanup', () => {
		const handlers = createExpandReportsHandlers({expandReports: true,},)

		handlers.cleanup()

		expect(siteTable().classList.contains(reportsExpandedClass,),).toBe(false,)
	})

	it('clears a class the toolbar toggled on even when the setting is off', () => {
		const handlers = createExpandReportsHandlers({expandReports: false,},)
		// Stands in for the toolbar's runtime expand button, which mutates the same class.
		siteTable().classList.add(reportsExpandedClass,)

		handlers.cleanup()

		expect(siteTable().classList.contains(reportsExpandedClass,),).toBe(false,)
	})

	it('does nothing on a page with no site table', () => {
		document.body.innerHTML = ''

		expect(() => createExpandReportsHandlers({expandReports: true,},).cleanup()).not.toThrow()
	})
})
