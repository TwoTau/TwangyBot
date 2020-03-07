# TwangyBot

A Discord bot that uses natural language processing (from [Wit.ai](https://wit.ai/)) to detect and parse 'reminder-type' messages.

To add a reminder, send a message with the word 'remind' and mention other users you want to remind.

## Features

- Persistent reminder data in `db.json`
- Send a reminder to multiple users
- List reminders
- TODO: Delete reminders

## Example `config.json`

```json
{
	"discord_token": "YOUR.DISCORD.TOKEN",
	"wit_token": "WITTOKEN",
	"min_time_confidence": 0.85,
	"min_reminder_confidence": 0.8
}
```