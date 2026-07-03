export interface Config {
  credentials: { username: string; password: string };
  forums: { url: string; label: string }[];
  pagesToScan: number;
  headless: boolean;
  outputFile: string;
  delay: { min: number; max: number };
  dbPath: string;
  favActresses?: string[];
}

export interface TopicData {
  title: string;
  postImage: string | null;
  starring: string | null;
  productionDate: string | null;
  duration: string | null;
  size: string | null;
  torrentUrl: string | null;
  topicUrl: string;
  sourceForum: string | null;
  hidden: number; // 0 or 1
}

export interface CrawlProgress {
  phase: "login" | "listing" | "detail" | "done" | "error" | "captcha-needed";
  message: string;
  current?: number;
  total?: number;
  captcha?: CaptchaInfo;
}

export interface CaptchaInfo {
  imageBase64: string; // data:image/png;base64,...
  captchaId: string;
}

export interface CrawlResult {
  topics: TopicData[];
  error?: string;
}
