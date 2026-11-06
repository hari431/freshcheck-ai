import { Router } from "express";
import { checkAnswer } from "../checkService.js";

const router = Router();

router.post("/check", async (req, res) => {
  const answer = typeof req.body?.answer === "string" ? req.body.answer.trim() : "";
  if (!answer) {
    return res.status(400).json({ error: "Please paste an answer to check." });
  }
  try {
    const result = await checkAnswer(answer);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      status: "service_failure",
      serviceError: "Verification service is temporarily unavailable. Please try again.",
      error: "Verification service is temporarily unavailable. Please try again.",
    });
  }
});

export default router;