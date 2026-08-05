import "dotenv/config";

import { randomBytes } from "node:crypto";
import express, { type Request, type Response } from "express";
import { google } from "googleapis";

function requireEnvironmentVariable(name: string): string {
	const value = process.env[name]?.trim();

	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}

	return value;
}

const port = Number(process.env.PORT ?? "3400");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
	throw new Error("PORT must be a valid TCP port.");
}

const googleClientId = requireEnvironmentVariable("GOOGLE_CLIENT_ID");
const googleClientSecret = requireEnvironmentVariable(
	"GOOGLE_CLIENT_SECRET",
);
const googleRedirectUri = requireEnvironmentVariable("GOOGLE_REDIRECT_URI");
const expectedChannelId = process.env.YOUTUBE_CHANNEL_ID?.trim();

const youtubeScope = "https://www.googleapis.com/auth/youtube.force-ssl";

const oauth2Client = new google.auth.OAuth2(
	googleClientId,
	googleClientSecret,
	googleRedirectUri,
);

const configuredRefreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();

if (configuredRefreshToken) {
	oauth2Client.setCredentials({
		refresh_token: configuredRefreshToken,
	});
}

const app = express();

// This is a local single-user service, so pending OAuth state can stay in memory.
const pendingOAuthStates = new Set<string>();

function getYoutubeClient() {
	return google.youtube({
		version: "v3",
		auth: oauth2Client,
	});
}

app.get("/", (_request: Request, response: Response) => {
	response.type("text/plain").send(
		[
			"Livestream Slack Bridge",
			"",
			"Authorize Google:",
			`http://localhost:${port}/oauth/google/start`,
			"",
			"Check authorization:",
			`http://localhost:${port}/youtube/me`,
		].join("\n"),
	);
});

app.get("/health", (_request: Request, response: Response) => {
	response.json({
		status: "ok",
		googleRefreshTokenConfigured: Boolean(configuredRefreshToken),
	});
});

app.get("/oauth/google/start", (_request: Request, response: Response) => {
	const state = randomBytes(32).toString("hex");

	pendingOAuthStates.add(state);

	setTimeout(() => {
		pendingOAuthStates.delete(state);
	}, 10 * 60 * 1000).unref();

	const authorizationUrl = oauth2Client.generateAuthUrl({
		access_type: "offline",
		prompt: "consent",
		include_granted_scopes: true,
		scope: [youtubeScope],
		state,
	});

	response.redirect(authorizationUrl);
});

app.get(
	"/oauth/google/callback",
	async (request: Request, response: Response) => {
		const oauthError =
			typeof request.query.error === "string"
				? request.query.error
				: undefined;
		const oauthErrorDescription =
			typeof request.query.error_description === "string"
				? request.query.error_description
				: undefined;

		if (oauthError) {
			response
				.status(400)
				.type("text/plain")
				.send(
					`Google authorization failed: ${oauthError}` +
						(oauthErrorDescription ? `\n${oauthErrorDescription}` : ""),
				);

			return;
		}

		const code =
			typeof request.query.code === "string"
				? request.query.code
				: undefined;

		const state =
			typeof request.query.state === "string"
				? request.query.state
				: undefined;

		if (!code) {
			response
				.status(400)
				.type("text/plain")
				.send("Google did not return an authorization code.");

			return;
		}

		if (!state || !pendingOAuthStates.delete(state)) {
			response
				.status(400)
				.type("text/plain")
				.send("Invalid or expired OAuth state.");

			return;
		}

		try {
			const { tokens } = await oauth2Client.getToken(code);
			const refreshToken = tokens.refresh_token ?? configuredRefreshToken;

			oauth2Client.setCredentials({
				...tokens,
				...(refreshToken ? { refresh_token: refreshToken } : {}),
			});

			const youtube = getYoutubeClient();
			const channelResponse = await youtube.channels.list({
				part: ["snippet"],
				mine: true,
			});
			const channel = channelResponse.data.items?.[0];

			if (!channel) {
				response
					.status(403)
					.type("text/plain")
					.send(
						"Authorization succeeded, but no YouTube channel was found for this Google account.",
					);

				return;
			}

			if (expectedChannelId && channel.id !== expectedChannelId) {
				response
					.status(403)
					.type("text/plain")
					.send(
						`Wrong YouTube channel authorized. Expected ${expectedChannelId}, received ${channel.id}.`,
					);

				return;
			}

			if (refreshToken) {
				console.log("\n==========================================");
				console.log("SAVE THIS IN YOUR .env FILE:");
				console.log(`GOOGLE_REFRESH_TOKEN=${refreshToken}`);
				console.log("==========================================\n");
			} else {
				console.warn(
					"Google did not return a refresh token. Revoke the app's existing access and authorize again.",
				);
			}

			response.type("text/plain").send(
				[
					"Google authorization succeeded.",
					"",
					`YouTube channel: ${channel.snippet?.title ?? "Unknown"}`,
					`YouTube channel ID: ${channel.id ?? "Unknown"}`,
					"",
					refreshToken
						? "The refresh token was printed in the service terminal."
						: "No refresh token was returned. Check the service terminal.",
					"",
					"Copy the refresh token into .env, then restart the service.",
				].join("\n"),
			);
		} catch (error) {
			console.error("Google OAuth callback failed:", error);

			response
				.status(500)
				.type("text/plain")
				.send("Google OAuth token exchange failed. Check the service terminal.");
		}
	},
);

app.get("/youtube/me", async (_request: Request, response: Response) => {
	if (!process.env.GOOGLE_REFRESH_TOKEN?.trim()) {
		response
			.status(401)
			.type("text/plain")
			.send(
				"GOOGLE_REFRESH_TOKEN is not configured. Visit /oauth/google/start first.",
			);

		return;
	}

	try {
		const youtube = getYoutubeClient();
		const channelResponse = await youtube.channels.list({
			part: ["snippet"],
			mine: true,
		});
		const channel = channelResponse.data.items?.[0];

		if (!channel) {
			response.status(404).type("text/plain").send("No YouTube channel was found.");

			return;
		}

		if (expectedChannelId && channel.id !== expectedChannelId) {
			response
				.status(403)
				.type("text/plain")
				.send(
					`Wrong YouTube channel authorized. Expected ${expectedChannelId}, received ${channel.id}.`,
				);

			return;
		}

		response.json({
			authorized: true,
			channelId: channel.id,
			channelName: channel.snippet?.title,
		});
	} catch (error) {
		console.error("YouTube authorization check failed:", error);

		response
			.status(500)
			.type("text/plain")
			.send("YouTube authorization check failed. Check the service terminal.");
	}
});

app.listen(port, "127.0.0.1", () => {
	console.log(`Livestream Slack Bridge running at http://localhost:${port}`);
});