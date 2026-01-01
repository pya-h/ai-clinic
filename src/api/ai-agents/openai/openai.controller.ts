import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OpenAiService } from './openai.service';

@ApiTags('OpenAI Agent')
@Controller('ai-agents/openai')
export class OpenAiAgentController {
  constructor(private readonly openAiService: OpenAiService) {}
  @Post()
  openNewChat(
    @Body() { message, userId }: { message: string; userId: number },
  ) {
    return this.openAiService.openNewChat(userId, message);
  }
}
