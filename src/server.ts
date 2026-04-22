import tanstackHandler from "@tanstack/react-start/server-entry";
import { routeAgentRequest } from "agents";
import { KramerVoiceAgent } from "./agents/kramer-voice-agent.ts";

export { KramerVoiceAgent };

export default {
	async fetch(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
	): Promise<Response> {
		const agentResponse = await routeAgentRequest(request, env);
		if (agentResponse) {
			return agentResponse;
		}
		return tanstackHandler.fetch(request);
	},
} satisfies ExportedHandler<Env>;
