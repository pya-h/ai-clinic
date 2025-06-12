import { ChatService } from './chat.service';
export declare class ChatController {
    private readonly chatService;
    constructor(chatService: ChatService);
    openNewChat({ message, userId }: {
        message: string;
        userId: number;
    }): Promise<string>;
}
