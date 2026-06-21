import { localWorkDataRepository as browserLocalRepository } from "@/lib/storage";
import { WorkData } from "@/lib/types";
import { WorkDataRepository } from "./work-data-repository";

export const localWorkDataRepository: WorkDataRepository = {
  async load() {
    return browserLocalRepository.load();
  },
  async save(data: WorkData) {
    browserLocalRepository.save(data);
  },
  async clear() {
    browserLocalRepository.clear();
  },
};
