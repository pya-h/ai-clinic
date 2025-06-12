import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ChatService } from './chat.service';

@ApiTags('Chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}
  @Post()
  openNewChat(
    @Body() { message, userId }: { message: string; userId: number },
  ) {
    return this.chatService.openNewChat(userId, message);
  }
}
