import TelegramBot from 'node-telegram-bot-api';
import winston from 'winston';

export interface TelegramConfig {
  token: string;
  chatId: string;
  enabled: boolean;
}

export class TelegramService {
  private bot: TelegramBot | null = null;
  private chatId: string = '';
  private enabled: boolean = false;
  private logger: winston.Logger;

  constructor(config?: TelegramConfig) {
    // Initialize logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'telegram-service.log' })
      ]
    });

    if (config) {
      this.initialize(config);
    }
  }

  initialize(config: TelegramConfig): void {
    try {
      this.enabled = config.enabled;
      
      if (!this.enabled) {
        this.logger.info('Telegram notifications are disabled');
        return;
      }

      if (!config.token) {
        this.logger.error('Telegram bot token is missing');
        this.enabled = false;
        return;
      }

      if (!config.chatId) {
        this.logger.error('Telegram chat ID is missing');
        this.enabled = false;
        return;
      }

      this.chatId = config.chatId;
      this.bot = new TelegramBot(config.token, { polling: false });
      this.logger.info('Telegram service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Telegram service:', error);
      this.enabled = false;
    }
  }

  async sendMessage(message: string): Promise<boolean> {
    if (!this.enabled || !this.bot) {
      return false;
    }

    try {
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
      return true;
    } catch (error) {
      this.logger.error('Failed to send Telegram message:', error);
      return false;
    }
  }

  async sendErrorAlert(errorMessage: string, context?: Record<string, any>): Promise<boolean> {
    if (!this.enabled || !this.bot) {
      return false;
    }

    try {
      let message = `🚨 <b>ERROR ALERT</b> 🚨\n\n${errorMessage}`;
      
      if (context) {
        message += '\n\n<b>Context:</b>\n<pre>' + JSON.stringify(context, null, 2) + '</pre>';
      }
      
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
      return true;
    } catch (error) {
      this.logger.error('Failed to send error alert to Telegram:', error);
      return false;
    }
  }

  async sendInfoAlert(infoMessage: string, context?: Record<string, any>): Promise<boolean> {
    if (!this.enabled || !this.bot) {
      return false;
    }

    try {
      let message = `ℹ️ <b>INFO</b> ℹ️\n\n${infoMessage}`;
      
      if (context) {
        message += '\n\n<b>Context:</b>\n<pre>' + JSON.stringify(context, null, 2) + '</pre>';
      }
      
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
      return true;
    } catch (error) {
      this.logger.error('Failed to send info alert to Telegram:', error);
      return false;
    }
  }
} 