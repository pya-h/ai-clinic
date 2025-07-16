import { Injectable } from '@nestjs/common';
import { ApiService } from 'src/api/api.service';

@Injectable()
export class BotpressService {
  private readonly apiUrl = 'https://api.botpress.cloud/v1/messages';
  private readonly channelId = 'YOUR_CHANNEL_ID'; // from Botpress Cloud
  private readonly apiKey = 'YOUR_API_KEY'; // from Botpress Cloud

  constructor(private readonly apiService: ApiService) {

    this.apiService.JwtToken = this.apiKey;
  }

  async sendMessage(userId: string, message: string) {
    const response = await this.apiService.post(
      this.apiUrl,
      {
        type: 'text',
        text: message,
        user: userId,
        channel: this.channelId,
      },
    );
    return response.data;
  }
}
