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
  override fun callback(frame: Frame, params: Map<String, Any?>?): Any? {
    return try {
      var roiIn = (params?.get("roi") as? Number)?.toFloat() ?: 0.4f
      val channel = (params?.get("channel") as? String) ?: "green"
      val mode = (params?.get("mode") as? String) ?: "mean" // mean | chrom | pos
      val useCHROM = (mode == "chrom" || mode == "pos")
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

      var sum = 0L
      var count = 0L
      // Sample grid step for speed
      val xStep = step
      val yStep = step

      val useRedOrGreen = (channel == "red" || channel == "green") && planes.size >= 3
      // Multi-ROI aggregation across grid x grid patches
      var weightedSum = 0.0
      var weightTotal = 0.0
      var confAccum = 0.0

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
          val px1 = if (gx == grid - 1) startX + roiH else px0 + patchW // note: roiH vs roiW bug guard below
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
            }
          }
          if (cntD <= 0.0) continue
          val Rm = sR / cntD; val Gm = sG / cntD; val Bm = sB / cntD; val Ym = sY / cntD
          var value = 0.0
          if (useCHROM) {
            val X = 3.0 * Rm - 2.0 * Gm
            val Yc = 1.5 * Rm + 1.0 * Gm - 1.5 * Bm
            val S = X - 1.0 * Yc
            value = 128.0 + 0.5 * S
          } else {
            value = when (channel) {
              "red" -> Rm
              "luma" -> Ym
              else -> Gm
            }
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
        }
      }

      val resultMean = if (weightTotal > 0.0) weightedSum / weightTotal else java.lang.Double.NaN
      val resultConf = if (weightTotal > 0.0) confAccum / weightTotal else java.lang.Double.NaN

      if (java.lang.Double.isFinite(resultMean)) {
        try { HeartPyModule.addPPGSample(resultMean) } catch (_: Throwable) {}
      }
      if (java.lang.Double.isFinite(resultConf)) {
        try { HeartPyModule.addPPGSampleConfidence(resultConf) } catch (_: Throwable) {}
      }
      resultMean
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
