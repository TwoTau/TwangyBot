import * as discord from 'discord.js'
import { Wit, log, MessageResponse } from 'node-wit'
import * as moment from 'moment'
import * as config from './config.json'
import { Database, Reminder } from './database'

// accesses Wit API
const witClient = new Wit({
	accessToken: config.wit_token,
	logger: new log.Logger(log.DEBUG)
})

// accesses Discord API
const bot = new discord.Client({
	disableMentions: 'everyone'
})
bot.login(config.discord_token)

const db = new Database()

bot.on('ready', () => {
	bot.user?.setActivity('the clock', { type: 'WATCHING' })
	db.addListener(sendReminder)
	db.initialize()
	console.log('TwangyBot online')
})

// Helper interfaces for Wit Response
type WitGrain = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year'
interface DatetimeValue {
	value: string,
	grain: WitGrain
}
interface DatetimeEntityInterval {
	confidence: number,
	to: DatetimeValue,
	from: DatetimeValue,
	type: 'interval'
}
interface DatetimeEntityValue {
	confidence: number,
	value: string,
	grain: WitGrain,
	type: 'value'
}
type DatetimeEntity = DatetimeEntityInterval | DatetimeEntityValue
interface ReminderEntity {
	confidence: number,
	suggested: boolean,
	value: string,
	type: 'value'
}

/**
 * Handles incoming Discord messages
 */
bot.on('message', (message: discord.Message) => {
	let cleanContent: string = message.cleanContent.trim().toLowerCase()

	// exit early if message does not meet requirements
	if (message.author.bot || message.channel.type !== 'text' ||
		cleanContent.length < 10 || !cleanContent.includes('remind')) {
		return
	}

	if (cleanContent.includes('list') && cleanContent.includes('reminder')) {
		listReminders(message.author, message.channel)
		return
	}

	witClient.message(message.cleanContent.trim(), {}).then((res: MessageResponse) => {
		addReminder(message, res)
	})
})

/**
 * Sends the list of upcoming reminders of the given user to the given channel.
 * Also sends a "how to use" message to the same channel.
 * @param author Discord user to list reminders of
 * @param channel Channel to send list message to
 */
function listReminders(author: discord.User, channel: discord.TextChannel) {
	const reminders: Reminder[] = db.getReminders(author.id)

	if (!reminders.length) { // no reminders
		const embed = new discord.MessageEmbed()
			.setColor(0x23BE5C)
			.setTitle(`${author.username}, you have no upcoming reminders`)
		channel.send({ embed })
	} else { // at least one reminder
		const titleText = reminders.length + (reminders.length === 1 ? ' reminder' : ' reminders')

		// Send reminder embeds in groups of 10 to stay under Discord's max message/field size
		const FIELDS_PER_EMBED = 10
		for (let n = 0; n < reminders.length; n += FIELDS_PER_EMBED) {
			const embed = new discord.MessageEmbed()
				.setColor(0x23BE5C)
				.setTitle(`${author.username}, you have ${titleText}`)

			for (let i = n; i < n + FIELDS_PER_EMBED && i < reminders.length; i++) {
				const rem: Reminder = reminders[i]
				let reminderText: string = `**For:** ${rem.end_at.format('llll')}\n` +
					`**Created:** ${rem.created_at.format('llll')}`

				if (rem.recipients.size > 1) {
					let recipients: string = [...rem.recipients].map(m => `<@${m}>`).join(', ')
					reminderText += `\n**Recipients (${rem.recipients.size}):** ${recipients}\n` +
						`**Creator:** <@${rem.author_id}>`
				}

				embed.addField(`#${i + 1}: ${rem.reminder}`, reminderText, true)
			}

			channel.send({ embed })
		}
	}

	// send "how to use" message
	const infoEmbed = new discord.MessageEmbed()
		.setColor(0xFFAC33)
		.setTitle(':reminder_ribbon: Twangybot: Reminders')
		.setDescription('Uses natural language processing to identify reminder-type messages. \
			To add a reminder, send a message with the word \'remind\' and mention other users \
			you want to remind. [Source code](https://github.com/TwoTau/TwangyBot)')
		.addField('`list reminders`', 'Lists your current reminders', false)
		.addField('`reminder delete <#>`',
			'Deletes a specific reminder if you are the author', false)
	channel.send({ embed: infoEmbed })
}

/**
 * Adds the given message as a Reminder to the database iff Wit has a high
 * confidence it is a reminder message
 * @param message Message that the author sent
 * @param witRes Wit API response
 */
function addReminder(message: discord.Message, witRes: MessageResponse): void {
	// exit early if Wit response does not have required reminder and datetime fields
	if (!witRes.entities?.reminder || !witRes.entities?.datetime) {
		return
	}

	let time: DatetimeEntity = witRes.entities.datetime[0]
	let reminderData: ReminderEntity[] = witRes.entities.reminder

	// exit if Wit has low confidence that the message contains a reminder
	if (time.confidence < config.min_time_confidence ||
		reminderData[0].confidence < config.min_reminder_confidence) {
		return
	}

	const reminder = reminderData[0].value
	const end_at = (time.type === 'value') ? time.value : time.to.value
	const timestamp = moment(end_at)

	// get set of mentioned user ids
	let mentionedIds: Set<string> = new Set(message.mentions.users.map(m => m.id))
	mentionedIds.add(message.author.id) // include author
	mentionedIds.delete(bot.user!.id) // exclude bot

	// format confirmation message
	const recipientsText: string = [...mentionedIds].map(m => `<@${m}>`).join(', ')
	const embed = new discord.MessageEmbed()
		.setColor(0xF5D838)
		.setDescription(`Will remind you ${timestamp.fromNow()} to "${reminder}"`)
		.addField('Reminder for', timestamp.calendar(), true)
		.addField(`Recipients (${mentionedIds.size})`, recipientsText, true)
	message.channel.send({ embed })

	db.addReminder({
		end_at: timestamp,
		created_at: moment(),
		author_id: message.author.id,
		recipients: mentionedIds,
		message: message.cleanContent.trim(),
		reminder,
	})
}

/**
 * Sends the given Reminder to everyone in reminders.recipients
 * @param reminder Reminder to send
 */
function sendReminder(reminder: Reminder) {
	const embed = new discord.MessageEmbed()
		.setColor(0xCB0B0B)
		.setDescription('**Reminder:** ' + reminder.reminder)
		.addField('Reminder for', reminder.end_at.format('llll'), false)
		.addField('Created on', reminder.created_at.format('llll'), false)
		.addField('Message', reminder.message)
		.setTimestamp()

	if (reminder.recipients.size > 1) {
		embed.addField('Recipients', reminder.recipients.size, true)
		embed.addField('Creator', `<@${reminder.author_id}>`, true)
	}

	for (let recipient of reminder.recipients) {
		bot.users.fetch(recipient).then((user: discord.User) => user.send({ embed }))
	}
}
