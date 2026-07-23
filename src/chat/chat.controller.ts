import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { CreateChatDto } from './dto/create-chat.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { PaginationOptionsDto } from '../common/dtos/pagination-options.dto';

@ApiTags('Chat')
@Controller('chat')
@UseGuards(CookieAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({ summary: 'Create or reopen a chat with another user' })
  async createChat(
    @CurrentUser() user: User,
    @Body() dto: CreateChatDto,
  ) {
    return this.chatService.createChat(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all chats for the current user' })
  async getUserChats(
    @CurrentUser() user: User,
    @Query() pagination: PaginationOptionsDto,
  ) {
    return this.chatService.getUserChats(
      user.id,
      pagination.skip,
      pagination.take,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get chat details by ID' })
  async getChatById(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) chatId: string,
  ) {
    return this.chatService.getChatById(chatId, user.id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get paginated messages for a chat' })
  async getMessages(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) chatId: string,
    @Query() pagination: PaginationOptionsDto,
  ) {
    return this.chatService.getMessages(
      chatId,
      user.id,
      pagination.skip,
      pagination.take,
    );
  }

  @Post(':id/message')
  @ApiOperation({ summary: 'Send a message (HTTP fallback for WebSocket)' })
  async sendMessage(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) chatId: string,
    @Body() dto: SendMessageDto,
  ) {
    const message = await this.chatService.sendMessage(chatId, user.id, dto);
    return this.chatService.serializeMessage(message);
  }
}
