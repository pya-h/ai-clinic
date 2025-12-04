import { OpenAiChatRoles } from "../enums/openai-roles.enum";

export type TOpenAiMessage = { role: OpenAiChatRoles; content: string };
