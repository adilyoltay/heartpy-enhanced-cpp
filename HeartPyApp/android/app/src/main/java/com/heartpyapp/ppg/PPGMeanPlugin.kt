package com.heartpyapp.ppg

import android.media.Image
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry
import java.nio.ByteBuffer
import com.heartpy.HeartPyModule

/**
 * Simple ROI mean-intensity plugin.
 *
 * Android fast-path uses Y (luma) plane from YUV_420 frame. This avoids color conversion.
 * Returns a Double (mean intensity 0..255) over a centered ROI.
 */
class PPGMeanPlugin : FrameProcessorPlugin() {
  // Rolling history buffers for aggregated ROI means (R,G,B,Y)
  private val HIST_N = 64
  private val rHist = DoubleArray(HIST_N)
  private val gHist = DoubleArray(HIST_N)
  private val bHist = DoubleArray(HIST_N)
  private val yHist = DoubleArray(HIST_N)
  private val vHist = DoubleArray(HIST_N)
  private var dcMean = Double.NaN
  private var histPos = 0
  private var histCount = 0
  override fun callback(frame: Frame, params: Map<String, Any?>?): Any? {
    return try {
      var roiIn = (params?.get("roi") as? Number)?.toFloat() ?: 0.4f
      val channel = (params?.get("channel") as? String) ?: "green"
      val mode = (params?.get("mode") as? String) ?: "mean" // mean | chrom | pos
      val useCHROM = (mode == "chrom" || mode == "pos")
      val blend = (params?.get("blend") as? String) ?: "off" // off | auto
      val autoBlend = (blend == "auto")
      val torchOnHint = (params?.get("torch") as? Boolean) ?: false
      val gridIn = (params?.get("grid") as? Number)?.toInt() ?: 1
      val grid = gridIn.coerceIn(1, 3)
      val stepIn = (params?.get("step") as? Number)?.toInt() ?: 2
      val step = stepIn.coerceIn(1, 8)
      // Clamp ROI to sane bounds
      var roi = roiIn.coerceIn(0.2f, 0.6f)

      val image = frame.image
      val planes = image.planes
      // Use plane 0 (Y plane) for mean intensity or as Y component for red estimation
      val yPlane = planes[0]
      val yBuffer: ByteBuffer = yPlane.buffer
      val yRowStride = yPlane.rowStride
      val yPixStride = yPlane.pixelStride

      val width = frame.width
      val height = frame.height
      if (width <= 0 || height <= 0) return java.lang.Double.NaN

      var roiW = (width * roi).toInt().coerceAtLeast(1)
      var roiH = (height * roi).toInt().coerceAtLeast(1)

      // Area guard: ensure ROI covers at least 10% of frame
      val minArea = 0.1f * width.toFloat() * height.toFloat()
      if (roiW.toFloat() * roiH.toFloat() < minArea) {
        roi = 0.4f
        roiW = (width * roi).toInt().coerceAtLeast(1)
        roiH = (height * roi).toInt().coerceAtLeast(1)
      }

      val startX = ((width - roiW) / 2).coerceAtLeast(0)
      val startY = ((height - roiH) / 2).coerceAtLeast(0)

      // Sample grid step for speed
      val xStep = step
      val yStep = step

      val useRedOrGreen = (channel == "red" || channel == "green") && planes.size >= 3
      // Multi-ROI aggregation across grid x grid patches
      var weightedSum = 0.0
      var weightTotal = 0.0
      var confAccum = 0.0
      var spatialSum = 0.0
      var spatialSqSum = 0.0
      var spatialSamples = 0.0
      var wSumR = 0.0; var wSumG = 0.0; var wSumB = 0.0; var wSumY = 0.0

      val uPlane = planes.getOrNull(1)
      val vPlane = planes.getOrNull(2)
      val uBuffer: ByteBuffer? = uPlane?.buffer
      val vBuffer: ByteBuffer? = vPlane?.buffer
      val uRowStride = uPlane?.rowStride ?: 0
      val uPixStride = uPlane?.pixelStride ?: 0
      val vRowStride = vPlane?.rowStride ?: 0
      val vPixStride = vPlane?.pixelStride ?: 0

      val patchW = (roiW / grid).coerceAtLeast(1)
      val patchH = (roiH / grid).coerceAtLeast(1)
      for (gy in 0 until grid) {
        for (gx in 0 until grid) {
          val px0 = startX + gx * patchW
          val py0 = startY + gy * patchH
          val px1 = if (gx == grid - 1) startX + roiW else px0 + patchW
          val py1 = if (gy == grid - 1) startY + roiH else py0 + patchH
          var sR = 0.0; var sG = 0.0; var sB = 0.0; var sY = 0.0; var cntD = 0.0
          val px1c = (startX + roiW).coerceAtMost(px1)
          for (y in py0 until py1 step yStep) {
            val yRow = y * yRowStride
            val uvY = y shr 1
            val uRow = uvY * uRowStride
            val vRow = uvY * vRowStride
            for (x in px0 until px1c step xStep) {
              val yIdx = yRow + x * yPixStride
              val Y = (yBuffer.get(yIdx).toInt() and 0xFF).toDouble()
              val uvX = x shr 1
              val uIdx = uRow + uvX * uPixStride
              val vIdx = vRow + uvX * vPixStride
              val Cb = (uBuffer?.get(uIdx)?.toInt() ?: 128) and 0xFF
              val Cr = (vBuffer?.get(vIdx)?.toInt() ?: 128) and 0xFF
              val cb = Cb.toDouble() - 128.0
              val cr = Cr.toDouble() - 128.0
              var R = Y + 1.402 * cr
              var G = Y - 0.344 * cb - 0.714 * cr
              var B = Y + 1.772 * cb
              if (R < 0.0) R = 0.0; if (R > 255.0) R = 255.0
              if (G < 0.0) G = 0.0; if (G > 255.0) G = 255.0
              if (B < 0.0) B = 0.0; if (B > 255.0) B = 255.0
              sR += R; sG += G; sB += B; sY += Y; cntD += 1.0
              spatialSum += Y
              spatialSqSum += Y * Y
              spatialSamples += 1.0
            }
          }
          if (cntD <= 0.0) continue
          val Rm = sR / cntD; val Gm = sG / cntD; val Bm = sB / cntD; val Ym = sY / cntD
          var value = when (channel) {
            "red" -> Rm
            "luma" -> Ym
            else -> Gm
          }
          if (value < 0.0) value = 0.0
          if (value > 255.0) value = 255.0
          val expScore = when {
            Ym < 15.0 -> (Ym / 15.0).coerceIn(0.0, 1.0)
            Ym > 240.0 -> ((255.0 - Ym) / 15.0).coerceIn(0.0, 1.0)
            else -> 1.0
          }
          val ampScore = if (useCHROM) {
            val Sabs = kotlin.math.abs((3.0 * Rm - 2.0 * Gm) - (1.5 * Rm + 1.0 * Gm - 1.5 * Bm))
            (Sabs / 50.0).coerceIn(0.0, 1.0)
          } else 0.0
          val conf = (0.7 * expScore + 0.3 * ampScore).coerceIn(0.0, 1.0)
          val w = expScore.coerceAtLeast(1e-6)
          weightedSum += w * value
          weightTotal += w
          confAccum += w * conf
          wSumR += w * Rm; wSumG += w * Gm; wSumB += w * Bm; wSumY += w * Ym
        }
      }
      val resultMean = if (weightTotal > 0.0) weightedSum / weightTotal else java.lang.Double.NaN
      val Ragg = if (weightTotal > 0.0) wSumR / weightTotal else Double.NaN
      val Gagg = if (weightTotal > 0.0) wSumG / weightTotal else Double.NaN
      val Bagg = if (weightTotal > 0.0) wSumB / weightTotal else Double.NaN
      val Yagg = if (weightTotal > 0.0) wSumY / weightTotal else Double.NaN

      val spatialMean = if (spatialSamples > 0.0) spatialSum / spatialSamples else Double.NaN
      val spatialVar = if (spatialSamples > 0.0) (spatialSqSum / spatialSamples) - spatialMean * spatialMean else 0.0
      val spatialStd = if (spatialVar.isNaN() || spatialVar <= 0.0) 0.0 else kotlin.math.sqrt(spatialVar)
      val contrastScore = (spatialStd / 12.0).coerceIn(0.0, 1.0)

      if (Ragg.isFinite() && Gagg.isFinite() && Bagg.isFinite() && Yagg.isFinite()) {
        rHist[histPos] = Ragg; gHist[histPos] = Gagg; bHist[histPos] = Bagg; yHist[histPos] = Yagg; vHist[histPos] = resultMean
        histPos = (histPos + 1) % HIST_N
        if (histCount < HIST_N) histCount++
      }

      // Compute out sample
      var chromVal = Double.NaN
      var chromAmp = 0.0
      if (histCount >= 8) {
        val N = histCount
        // CHROM rolling alpha over history
        var meanX = 0.0; var meanYc = 0.0
        for (i in 0 until N) {
          val idx = (histPos - 1 - i + HIST_N) % HIST_N
          val X = 3.0 * rHist[idx] - 2.0 * gHist[idx]
          val Yc = 1.5 * rHist[idx] + 1.0 * gHist[idx] - 1.5 * bHist[idx]
          meanX += X; meanYc += Yc
        }
        meanX /= N; meanYc /= N
        var varX = 0.0; var varY = 0.0
        for (i in 0 until N) {
          val idx = (histPos - 1 - i + HIST_N) % HIST_N
          val X = 3.0 * rHist[idx] - 2.0 * gHist[idx]
          val Yc = 1.5 * rHist[idx] + 1.0 * gHist[idx] - 1.5 * bHist[idx]
          varX += (X - meanX) * (X - meanX)
          varY += (Yc - meanYc) * (Yc - meanYc)
        }
        val stdX = kotlin.math.sqrt(varX / kotlin.math.max(1, N - 1).toDouble())
        val stdY = kotlin.math.sqrt(varY / kotlin.math.max(1, N - 1).toDouble())
        chromAmp = stdX
        val alpha = if (stdY > 1e-6) stdX / stdY else 1.0
        val lastIdx = (histPos - 1 + HIST_N) % HIST_N
        val Xcur = 3.0 * rHist[lastIdx] - 2.0 * gHist[lastIdx]
        val Ycur = 1.5 * rHist[lastIdx] + 1.0 * gHist[lastIdx] - 1.5 * bHist[lastIdx]
        val Sc = if (mode == "chrom") {
          Xcur - alpha * Ycur
        } else {
          // POS: normalized RGB, S1_last + alpha_pos * S2_last
          var meanR = 0.0; var meanG = 0.0; var meanB = 0.0
          for (i in 0 until N) {
            val idx = (histPos - 1 - i + HIST_N) % HIST_N
            meanR += rHist[idx]; meanG += gHist[idx]; meanB += bHist[idx]
          }
          meanR /= N; meanG /= N; meanB /= N
          var s1m = 0.0; var s2m = 0.0
          for (i in 0 until N) {
            val idx = (histPos - 1 - i + HIST_N) % HIST_N
            val rN = rHist[idx] / kotlin.math.max(1e-6, meanR) - 1.0
            val gN = gHist[idx] / kotlin.math.max(1e-6, meanG) - 1.0
            val bN = bHist[idx] / kotlin.math.max(1e-6, meanB) - 1.0
            val s1 = 3.0 * rN - 2.0 * gN
            val s2 = 1.5 * rN + 1.0 * gN - 1.5 * bN
            s1m += s1; s2m += s2
          }
          s1m /= N; s2m /= N
          var v1 = 0.0; var v2 = 0.0
          for (i in 0 until N) {
            val idx = (histPos - 1 - i + HIST_N) % HIST_N
            val rN = rHist[idx] / kotlin.math.max(1e-6, meanR) - 1.0
            val gN = gHist[idx] / kotlin.math.max(1e-6, meanG) - 1.0
            val bN = bHist[idx] / kotlin.math.max(1e-6, meanB) - 1.0
            val s1 = 3.0 * rN - 2.0 * gN
            val s2 = 1.5 * rN + 1.0 * gN - 1.5 * bN
            v1 += (s1 - s1m) * (s1 - s1m)
            v2 += (s2 - s2m) * (s2 - s2m)
          }
          val std1 = kotlin.math.sqrt(v1 / kotlin.math.max(1, N - 1).toDouble())
          val std2 = kotlin.math.sqrt(v2 / kotlin.math.max(1, N - 1).toDouble())
          val aPos = if (std2 > 1e-6) std1 / std2 else 1.0
          val rN = rHist[lastIdx] / kotlin.math.max(1e-6, meanR) - 1.0
          val gN = gHist[lastIdx] / kotlin.math.max(1e-6, meanG) - 1.0
          val bN = bHist[lastIdx] / kotlin.math.max(1e-6, meanB) - 1.0
          val s1 = 3.0 * rN - 2.0 * gN
          val s2 = 1.5 * rN + 1.0 * gN - 1.5 * bN
          s1 + aPos * s2
        }
        val k = 0.5
        chromVal = (128.0 + k * Sc).coerceIn(0.0, 255.0)
      }

      var windowMean = resultMean
      var temporalScore = 0.2
      if (histCount >= 6) {
        val window = kotlin.math.min(histCount, 30)
        var meanHist = 0.0
        for (i in 0 until window) {
          val idx = (histPos - 1 - i + HIST_N) % HIST_N
          meanHist += vHist[idx]
        }
        meanHist /= window.toDouble()
        windowMean = meanHist
        var varHist = 0.0
        for (i in 0 until window) {
          val idx = (histPos - 1 - i + HIST_N) % HIST_N
          val d = vHist[idx] - meanHist
          varHist += d * d
        }
        val stdHist = kotlin.math.sqrt(varHist / kotlin.math.max(1, window - 1).toDouble())
        temporalScore = (stdHist / 6.0).coerceIn(0.0, 1.0)
      }
      if (!temporalScore.isFinite()) temporalScore = 0.0
      val amplitudeScore = (chromAmp / 35.0).coerceIn(0.0, 1.0)

      // Dynamic exposure gating via percentiles of Y history
      var expoGate = 1.0
      if (histCount >= 16) {
        val N = histCount
        val tmp = DoubleArray(N)
        for (i in 0 until N) {
          val idx = (histPos - 1 - i + HIST_N) % HIST_N
          tmp[i] = yHist[idx]
        }
        java.util.Arrays.sort(tmp)
        val p10 = tmp[(0.1 * (N - 1)).toInt()]
        val p90 = tmp[(0.9 * (N - 1)).toInt()]
        val gDark = (p10 / 20.0).coerceIn(0.0, 1.0)
        val gSat = ((255.0 - p90) / 20.0).coerceIn(0.0, 1.0)
        expoGate = kotlin.math.min(gDark, gSat)
      }
      val expoScore = expoGate.coerceIn(0.0, 1.0)
      val patchScore = if (weightTotal > 0.0) (confAccum / weightTotal).coerceIn(0.0, 1.0) else expoScore
      val spatialGate = (0.6 * expoScore + 0.4 * contrastScore).coerceIn(0.0, 1.0)
      val dynamicMix = (0.7 * temporalScore + 0.3 * amplitudeScore).coerceIn(0.0, 1.0)
      val reliability = kotlin.math.sqrt((spatialGate * dynamicMix).coerceIn(0.0, 1.0))
      val baseConf = (0.3 * patchScore + 0.7 * reliability).coerceIn(0.0, 1.0)
      val confMean = baseConf
      val confChrom = (0.6 * baseConf + 0.4 * dynamicMix).coerceIn(0.0, 1.0)

      // Default by mode
      var outVal = if (mode == "mean" || !chromVal.isFinite()) resultMean else chromVal
      var outConf = if (mode == "mean" || !chromVal.isFinite()) confMean else confChrom
      var blendWeight = 0.0
      var blendUsed = false

      // Auto crossfade based on confidence and torch hint
      if (autoBlend && (resultMean.isFinite() || chromVal.isFinite())) {
        var wTorch = if (torchOnHint) 0.0 else 1.0
        val wSnr = confChrom
        var w = (0.7 * wSnr + 0.3 * wTorch).coerceIn(0.0, 1.0)
        if (!chromVal.isFinite()) w = 0.0
        if (!resultMean.isFinite()) w = 1.0
        val mv = if (resultMean.isFinite()) resultMean else 0.0
        val cv = if (chromVal.isFinite()) chromVal else 0.0
        outVal = (1.0 - w) * mv + w * cv
        outConf = (1.0 - w) * confMean + w * confChrom
        blendWeight = w
        blendUsed = true
      }

      if (!windowMean.isFinite() && resultMean.isFinite()) windowMean = resultMean
      if (!dcMean.isFinite() && windowMean.isFinite()) dcMean = windowMean
      val prevDc = if (dcMean.isFinite()) dcMean else windowMean
      val alphaDc = if (histCount >= 16) 0.03 else 0.06
      val nextDc = if (windowMean.isFinite()) prevDc + alphaDc * (windowMean - prevDc) else prevDc
      dcMean = nextDc
      val meanComponent = if (resultMean.isFinite() && nextDc.isFinite()) ((resultMean - nextDc) / 120.0).coerceIn(-1.2, 1.2) else Double.NaN
      val chromComponent = if (chromVal.isFinite()) ((chromVal - 128.0) / 160.0).coerceIn(-1.2, 1.2) else Double.NaN
      val pushRaw = when {
        blendUsed -> {
          val mc = if (meanComponent.isFinite()) meanComponent else 0.0
          val cc = if (chromComponent.isFinite()) chromComponent else 0.0
          (1.0 - blendWeight) * mc + blendWeight * cc
        }
        mode == "chrom" || mode == "pos" -> chromComponent
        else -> meanComponent
      }
      var finalSample = pushRaw
      if (!finalSample.isFinite()) finalSample = Double.NaN
      var confidenceOut = outConf.coerceIn(0.0, 1.0)
      val amplitudeGate = (spatialGate * dynamicMix).coerceIn(0.0, 1.0)
      if (amplitudeGate < 0.05) confidenceOut = kotlin.math.min(confidenceOut, amplitudeGate * 0.8)
      val absSample = if (finalSample.isFinite()) kotlin.math.abs(finalSample) else 0.0
      if (absSample < 0.01) confidenceOut *= absSample * 50.0
      val pushSample = if (!finalSample.isFinite() || amplitudeGate < 0.02) Double.NaN else finalSample.coerceIn(-1.2, 1.2)

      // Publish sample + ts (seconds) to native buffer
      if (pushSample.isFinite()) {
        try {
          // Frame timestamp'i kullan, yoksa system time kullan
          val tsNanos = try { 
            frame.timestamp 
          } catch (_: Throwable) { 
            System.nanoTime() 
          }
          val tsSec = tsNanos.toDouble() / 1_000_000_000.0
          
          // Debug: Her 30 frame'de bir timestamp log'la
          if (histCount % 30 == 0) {
            android.util.Log.d("PPGPlugin", "PPG value: $pushSample, ts: $tsSec, conf: $confidenceOut")
          }
          
          HeartPyModule.addPPGSampleWithTs(pushSample, tsSec)
        } catch (_: Throwable) {}
      }
      try { HeartPyModule.addPPGSampleConfidence(confidenceOut) } catch (_: Throwable) {}
      pushSample
    } catch (t: Throwable) {
      java.lang.Double.NaN
    }
  }

  companion object Registrar {
    @JvmStatic
    fun register() {
      FrameProcessorPluginRegistry.addFrameProcessorPlugin("ppgMean") { _, _ ->
        PPGMeanPlugin()
      }
    }
  }
}
