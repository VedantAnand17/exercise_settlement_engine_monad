import axios from "axios";
import {
  OptionsResponse,
  GetRatesRequest,
  GetRatesResponse,
} from "../types/Option";

export class OptionsService {
  private readonly baseUrl: string;

  constructor(baseUrl: string = "http://localhost:42069") {
    this.baseUrl = baseUrl;
  }

  async getExpiringOptions(): Promise<OptionsResponse> {
    try {
      const response = await axios.get<OptionsResponse>(
        `${this.baseUrl}/expiring-options`
      );
      return response.data;
    } catch (error) {
      console.error("Error fetching expiring options:", error);
      throw error;
    }
  }

  async getExpiredOptions(): Promise<OptionsResponse> {
    try {
      const response = await axios.get<OptionsResponse>(
        `${this.baseUrl}/expired-options`
      );
      return response.data;
    } catch (error) {
      console.error("Error fetching expired options:", error);
      throw error;
    }
  }

  async getRates(request: GetRatesRequest): Promise<GetRatesResponse> {
    try {
      const response = await axios.post<GetRatesResponse>(
        `${this.baseUrl}/get-rates`,
        request
      );
      return response.data;
    } catch (error) {
      console.error("Error fetching rates:", error);
      throw error;
    }
  }
}
