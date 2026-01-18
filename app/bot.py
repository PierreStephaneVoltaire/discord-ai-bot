import discord
import aiohttp
import os
import logging
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("discord_bot")

# Config
DISCORD_TOKEN = os.environ.get("DISCORD_TOKEN")
N8N_WEBHOOK_URL = os.environ.get("N8N_WEBHOOK_URL")

if not N8N_WEBHOOK_URL:
    logger.warning("N8N_WEBHOOK_URL is not set! Messages will not be forwarded.")
else:
    logger.info(f"N8N_WEBHOOK_URL configured: {N8N_WEBHOOK_URL}")

intents = discord.Intents.default()
intents.message_content = True

client = discord.Client(intents=intents)


@client.event
async def on_ready():
    logger.info(f"Bot connected as {client.user} (ID: {client.user.id})")


@client.event
async def on_message(message):
    logger.info(f"Received message from {message.author} (ID: {message.author.id}) in channel {message.channel.id}")
    
    # Optional: Ignore own messages to prevent loops, but logging it first is good for debugging
    if message.author == client.user:
        logger.info("Ignoring message from self.")
        return

    # Build payload matching what the n8n workflow expects
    payload = {
        "id": str(message.id),
        "channel_id": str(message.channel.id),
        "guild_id": str(message.guild.id) if message.guild else None,
        "content": message.content,
        "author": {
            "id": str(message.author.id),
            "username": message.author.name,
            "discriminator": message.author.discriminator,
            "bot": message.author.bot,
        },
        "attachments": [
            {
                "id": str(a.id),
                "filename": a.filename,
                "url": a.url,
                "content_type": a.content_type,
            }
            for a in message.attachments
        ],
        "timestamp": message.created_at.isoformat(),
    }

    if not N8N_WEBHOOK_URL:
        logger.error("Skipping forwarding: N8N_WEBHOOK_URL is missing.")
        return

    logger.info(f"Forwarding message {message.id} to n8n webhook...")
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(N8N_WEBHOOK_URL, json=payload) as resp:
                if resp.status == 200:
                    logger.info(f"Successfully forwarded message {message.id}.")
                else:
                    response_text = await resp.text()
                    logger.error(f"Webhook error: {resp.status} - {response_text}")
    except Exception as e:
        logger.exception(f"Failed to forward message: {e}")


if __name__ == "__main__":
    if not DISCORD_TOKEN:
        logger.critical("DISCORD_TOKEN is not set!")
        sys.exit(1)
    client.run(DISCORD_TOKEN)
