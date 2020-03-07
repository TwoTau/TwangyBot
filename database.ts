import { promises as fs } from 'fs'
import * as moment from 'moment'

const DB_FILE_NAME = 'db.json'

export interface Reminder {
	created_at: moment.Moment,
	end_at: moment.Moment,
	reminder: string,
	author_id: string,
	recipients: Set<string>,
	message: string,
}

interface ReminderInternal {
	created_at: string, // ISO string
	end_at: string, // ISO string
	reminder: string,
	author_id: string,
	recipients: string[],
	message: string,
}

/**
 * Compares two Reminders for sorting in chronological end-time order from
 * soonest to latest. If both end at the same time, sorts them in order of
 * creation time from earliest to latest.
 * @param a Reminder 1 to compare
 * @param b Reminder 2 to compare
 * @returns 0 if same, -1 if a comes before b, else 1
 */
function sortReminders(a: Reminder, b: Reminder): number {
	if (a.end_at.isSame(b.end_at)) {
		if (a.created_at.isSame(b.created_at)) {
			return 0
		}
		return a.created_at.isBefore(b.created_at) ? -1 : 1
	}
	return a.end_at.isBefore(b.end_at) ? -1 : 1
}

/**
 * Stores and manages reminders for each Discord user.
 * Notifies listeners when a reminder expires.
 */
export class Database {
	private data: Reminder[]
	private listeners: Set<Function>
	private reminderToTimeout: Map<Reminder, NodeJS.Timeout>

	constructor() {
		this.data = []
		this.listeners = new Set()
		this.reminderToTimeout = new Map()
	}

	/**
	 * Loads all reminders.
	 */
	public async initialize() {
		let reminders: ReminderInternal[]
		try {
			const dbData = await fs.readFile(DB_FILE_NAME)
			reminders = JSON.parse(dbData.toString())
		} catch (e) { // no db file
			reminders = []
		}

		let reminderList: Reminder[] = reminders.map((r: ReminderInternal) => ({
			created_at: moment(r.created_at),
			end_at: moment(r.end_at),
			recipients: new Set(r.recipients),
			reminder: r.reminder,
			author_id: r.author_id,
			message: r.message,
		}))

		for (let rem of reminderList) {
			this.data.push(rem)
			this.loadReminder(rem)
		}
	}

	/**
	 * Saves all current reminder data to JSON file.
	 */
	private saveData() {
		let internal: ReminderInternal[] = this.data.map((r: Reminder) => ({
			created_at: r.created_at.toISOString(),
			end_at: r.end_at.toISOString(),
			recipients: Array.from(r.recipients),
			reminder: r.reminder,
			author_id: r.author_id,
			message: r.message,
		}))

		return fs.writeFile(DB_FILE_NAME, JSON.stringify(internal))
	}

	/**
	 * Returns sorted list of reminders where the given user is a recipient
	 * @param userId Discord ID of user to return reminders of
	 * @returns user's reminders in order of soonest to latest end time
	 */
	public getReminders(userId: string): Reminder[] {
		return this.data.filter((rem: Reminder) =>
			rem.recipients.has(userId) && rem.end_at.isAfter(moment())).sort(sortReminders)
	}

	/**
	 * Saves the given reminder and will notify listeners when it expires.
	 * If reminder's expiration is in the past, sends notification immediately.
	 * @param reminder Reminder to add to the database
	 */
	public addReminder(reminder: Reminder): void {
		this.data.push(reminder)
		this.loadReminder(reminder)
		this.saveData()
	}

	/**
	 * Removes reminder from this.data and saves database.
	 * @param reminder Reminder to remove
	 */
	private removeReminderFromDb(reminder: Reminder): void {
		const index = this.data.indexOf(reminder)
		if (index !== -1) {
			this.data.splice(index, 1)
			this.saveData()
		}
	}

	/**
	 * Loads the reminder so that all the listeners will be notified when the
	 * reminder expires. Should not be called twice with the same reminder.
	 * If reminder's expiration is in the past, sends notification immediately.
	 * @param reminder Reminder to load
	 */
	private loadReminder(reminder: Reminder): void {
		const endTime = moment(reminder.end_at)
		const isSoonish = (endTime.diff(moment(), 'days') < 20)
		if (isSoonish) {
			// msDelay >= 0
			const msDelay = Math.max(0, endTime.diff(moment(), 'milliseconds'))

			let timeout: NodeJS.Timeout = setTimeout(() => {
				this.removeReminderFromDb(reminder)
				this.notifyListeners(reminder)
			}, msDelay)

			this.reminderToTimeout.set(reminder, timeout)
		}
	}

	/**
	 * Registers a listener for when a reminder expires. Only adds the listener
	 * if it has not already been added.
	 * @param callback Listener function to notify
	 */
	public addListener(callback: Function): void {
		this.listeners.add(callback)
	}

	/**
	 * Unregisters the given reminder listener. Does nothing if function was
	 * never registered.
	 * @param callback Listener to remove from notify list
	 */
	public removeListener(callback: Function): boolean {
		return this.listeners.delete(callback)
	}

	/**
	 * Calls every listener asynchronously with the given reminder.
	 * @param reminder Reminder to send to each listener
	 */
	private notifyListeners(reminder: Reminder): void {
		for (let listener of this.listeners) {
			// execute asynchronously
			(async () => listener(reminder))()
		}
	}
}
