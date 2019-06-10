const discord = require("discord.js");
const {Wit, log} = require("node-wit");
const fs = require("fs");
const moment = require("moment");
const config = require("./config.json");
const db = require("./db.json");

const witClient = new Wit({
	accessToken: config.wit_token,
	logger: new log.Logger(log.DEBUG)
});

const twangybot = new discord.Client({
	disableEveryone: true
});

twangybot.login(config.discord_token);

twangybot.on("ready", () => {
	twangybot.user.setActivity("the clock", {type: "WATCHING"});
	
	db.reminders = db.reminders.filter(reminder => moment(reminder.end_time).isAfter(moment()));
	saveDatabase();
	
	for (let reminder of db.reminders) {
		loadReminder(reminder);
	}
	
	console.log("TwangyBot online");
});

function saveDatabase() {
	fs.writeFile("db.json", JSON.stringify(db), err => {
		if (err) {
			console.error(error)
		}
	});
}

function addNewReminder(endTime, recipientsList, authorId, reminder) {
	let reminderObject = {
		"created_at": moment().toISOString(),
		"end_time": endTime,
		"reminder": reminder,
		"author_id": authorId,
		"recipients": recipientsList
	};
	
	db.reminders.push(reminderObject);
	
	saveDatabase();
	
	loadReminder(reminderObject);
}

function loadReminder(reminder) {
	let endTime = moment(reminder.end_time);
	let isSoonish = (endTime.diff(moment(), "days") < 20);
	if (isSoonish) {
		let msDelay = endTime.diff(moment(), "milliseconds");
		setTimeout(function() {
			sendReminder(reminder);
		}, msDelay);
	}
}

function sendReminder(reminder) {
	for (let recipientId of reminder.recipients) {
		twangybot.fetchUser(recipientId).then(recipient => {
			const embed = new discord.RichEmbed()
				.setColor(0xCB0B0B)
				.setDescription("**Reminder:** " + reminder.reminder)
				.addField("Reminder for", moment(reminder.end_time).format("llll"), false)
				.addField("Created on", moment(reminder.created_at).format("llll"), false)
				.setTimestamp();
			
			if (reminder.recipients.length > 1) {
				embed.addField("Recipients", reminder.recipients.length, true);
				if (reminder.author_id !== recipientId) {
					embed.addField("Creator", `<@${reminder.author_id}>`, true);
				}
			}
						
			recipient.send({embed});
		}).catch(console.error);
	}
}

twangybot.on("message", message => {
	
	let cleanContent = message.cleanContent.trim().toLowerCase();
	
	if (message.author.bot || message.channel.type !== "text" || cleanContent.length < 14) {
		return;
	}
	
	if (cleanContent === "list reminders" || cleanContent === "reminders list") {
		let userReminders = db.reminders.filter(reminder => reminder.recipients.includes(message.author.id));
		let text = userReminders.map(reminder => `"${reminder.reminder}" at ${moment(reminder.end_time).calendar()}`);
		message.channel.send(text.join("\n"));
	}
	
	let mentionedIds = message.mentions.users.map(member => member.id);
	
	if (!mentionedIds.includes(message.author.id)) {
		mentionedIds.push(message.author.id);
	}
	
	witClient.message(cleanContent).then(witResponse => {
		
		if (witResponse.entities && witResponse.entities.reminder && witResponse.entities.datetime) {
			
			let timesList = witResponse.entities.datetime;
			let reminderData = witResponse.entities.reminder;
			
			if (timesList[0].confidence > 0.85 && reminderData[0].confidence > 0.8) {
				
				let reminder = reminderData[0].value;
				let endTime = timesList[0].value;
				let timestamp = moment(endTime);
				
				message.channel.send(`Will remind you ${timestamp.fromNow()} (${timestamp.calendar()}) "${reminder}"`);
				
				addNewReminder(endTime, mentionedIds, message.author.id, reminder);
			}
		}
	}).catch(console.error);
	
});