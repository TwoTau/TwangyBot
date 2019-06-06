import discord
from wit import Wit

DISCORD_TOKEN = 'xxx'
WIT_TOKEN = 'xxx'

discord_client = discord.Client()

wit_client = Wit(WIT_TOKEN)

@client.event
async def on_message(message):
	# do not respond to own messages
	if message.author == discord_client.user:
		return
	
	content = message.content.lower()
	
	# respond to only messages starting with twangy
	if not content.startswith('twangy'):
		return
	
	msg = 'Hello {0.author.mention}'.format(message)
	await discord_client.send_message(message.channel, msg)

@client.event
async def on_ready():
	print('Username: ' + discord_client.user.name)
	print('Id: ' + discord_client.user.id)

discord_client.run(DISCORD_TOKEN)
