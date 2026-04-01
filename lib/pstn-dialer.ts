import axios, { AxiosInstance } from "axios";

export interface DialerConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}

export interface CallRequest {
  callType: "voice" | "sms-mo" | "sms-mt";
  callerNumber?: string;
  calledNumber?: string;
  status?: "INITIATED" | "ANSWERED" | "COMPLETED" | "HUNGUP" | "QUEUED";
  messageText?: string;
  duration?: number;
  recordingUrl?: string;
  timestamp?: number;
  callId?: string;
  audioData?: string;
  sequenceNumber?: number;
}

export default class PSTNDialer {
  private client: AxiosInstance;
  private config: DialerConfig;

  constructor(config: DialerConfig) {
    this.config = { timeout: 160000, ...config };
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
      },
    });
  }

  async initiateCall(callerNumber: string, calledNumber: string) {
    const request: CallRequest = {
      callType: "voice",
      callerNumber: callerNumber || "",
      calledNumber: calledNumber || "",
      status: "INITIATED",
      timestamp: Math.floor(Date.now() / 1000),
    };
    console.log(`📤 initiateCall → caller: ${callerNumber} | called: ${calledNumber}`);
    return this.sendCall(request);
  }

  async checkIncomingCalls(calledNumber: string) {
    const request: CallRequest = {
      callType: "voice",
      status: "INITIATED",
      calledNumber: calledNumber || "",
      callerNumber: "",                    // On laisse vide pour dire "cherche les entrants"
      timestamp: Math.floor(Date.now() / 1000),
    };
    console.log(`🔍 checkIncomingCalls polling pour appelé: ${calledNumber}`);
    return this.sendCall(request);
  }

  async answerCall(callId: string, options: { callerNumber: string; calledNumber: string }) {
    const request: CallRequest = {
      callType: "voice",
      callerNumber: options.callerNumber || "",
      calledNumber: options.calledNumber || "",
      status: "ANSWERED",
      callId: callId || "",
      timestamp: Math.floor(Date.now() / 1000),
    };
    return this.sendCall(request);
  }

  async sendAudioData(
    callId: string,
    audioData: string,
    sequenceNumber: number,
    callerNumber: string = "",
    calledNumber: string = ""
  ) {
    if (!audioData) return { success: false, message: "audioData vide" };

    const request: CallRequest = {
      callType: "voice",
      status: "ANSWERED",
      callId,
      callerNumber,
      calledNumber,
      audioData,
      sequenceNumber,
      timestamp: Math.floor(Date.now() / 1000),
    };

    console.log(`📤 Audio chunk #${sequenceNumber} → caller: ${callerNumber} | called: ${calledNumber}`);
    return this.sendCall(request);
  }

  async hangupCall(callId: string, duration: number, options: { callerNumber: string; calledNumber: string }) {
    const request: CallRequest = {
      callType: "voice",
      callerNumber: options.callerNumber || "",
      calledNumber: options.calledNumber || "",
      status: "HUNGUP",
      callId: callId || "",
      duration: duration || 0,
      timestamp: Math.floor(Date.now() / 1000),
    };
    return this.sendCall(request);
  }

  private async sendCall(request: CallRequest) {
    try {
      const response = await this.client.post("/api/ss7-oracle", request);
      return response.data;
    } catch (error: any) {
      console.error("🔥 ERREUR ORACLE :", error.response?.data || error.message);
      throw error;
    }
  }
}
