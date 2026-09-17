export type Copy = {
  app: {
    name: string;
    placeholder: string;
  };
};

export const copy = {
  app: {
    name: "Mi TSM",
    placeholder: "Portal en construcción",
  },
} as const satisfies Copy;
