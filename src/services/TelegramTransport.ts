import * as winstonTransport from "winston-transport";
import { TelegramService } from "./TelegramService";

const TransportClass = winstonTransport.default || winstonTransport;

interface TelegramTransportOptions
  extends winstonTransport.TransportStreamOptions {
  telegramService: TelegramService;
  level?: string;
  handleExceptions?: boolean;
  format?: any;
  // Define which log levels should be sent to Telegram
  levels?: {
    error?: boolean;
    warn?: boolean;
    info?: boolean;
    http?: boolean;
    verbose?: boolean;
    debug?: boolean;
    silly?: boolean;
  };
}

export class TelegramTransport extends TransportClass {
  private telegramService: TelegramService;
  private enabledLevels: Record<string, boolean>;

  constructor(opts: TelegramTransportOptions) {
    super(opts);
    this.telegramService = opts.telegramService;

    // Default to only sending error logs to Telegram
    this.enabledLevels = {
      error: true,
      warn: false,
      info: false,
      http: false,
      verbose: false,
      debug: false,
      silly: false,
      ...opts.levels,
    };
  }

  async log(info: any, callback: () => void) {
    const level = info.level || "info";

    // Check if this log level should be sent to Telegram
    if (!this.enabledLevels[level]) {
      callback();
      return;
    }

    try {
      // Extract message and metadata
      const message = info.message || "";
      const metadata = { ...info };

      // Remove standard properties from metadata
      delete metadata.level;
      delete metadata.message;
      delete metadata.timestamp;

      // Format the log message for Telegram
      let formattedMessage = "";

      if (level === "error") {
        await this.telegramService.sendErrorAlert(message, metadata);
      } else if (level === "warn") {
        formattedMessage = `⚠️ <b>WARNING</b> ⚠️\n\n${message}`;
        await this.telegramService.sendMessage(formattedMessage);
      } else {
        await this.telegramService.sendInfoAlert(message, metadata);
      }
    } catch (error) {
      console.error("Error sending log to Telegram:", error);
    }

    callback();
  }
}
