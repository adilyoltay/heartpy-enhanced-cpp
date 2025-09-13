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
      val resultMean = if (useRedOrGreen) {
        // U/Cb plane at index 1, V/Cr at index 2
        val uPlane = planes[1]
        val vPlane = planes[2]
        val uBuffer: ByteBuffer = uPlane.buffer
        val vBuffer: ByteBuffer = vPlane.buffer
        val uRowStride = uPlane.rowStride
        val uPixStride = uPlane.pixelStride
        val vRowStride = vPlane.rowStride
        val vPixStride = vPlane.pixelStride

        for (y in startY until (startY + roiH) step yStep) {
          val yRow = y * yRowStride
          val uvY = y shr 1
          val uRow = uvY * uRowStride
          val vRow = uvY * vRowStride
          for (x in startX until (startX + roiW) step xStep) {
            val yIdx = yRow + x * yPixStride
            val uvX = x shr 1
            val uIdx = uRow + uvX * uPixStride
            val vIdx = vRow + uvX * vPixStride
            val Y = (yBuffer.get(yIdx).toInt() and 0xFF).toDouble()
            val Cb = (uBuffer.get(uIdx).toInt() and 0xFF).toDouble()
            val Cr = (vBuffer.get(vIdx).toInt() and 0xFF).toDouble()
            val cb = Cb - 128.0
            val cr = Cr - 128.0
            var comp = if (channel == "red") {
              // R ≈ Y + 1.402 * (Cr-128)
              Y + 1.402 * cr
            } else {
              // G ≈ Y − 0.344*(Cb-128) − 0.714*(Cr-128)
              Y - 0.344 * cb - 0.714 * cr
            }
            if (comp < 0.0) comp = 0.0
            if (comp > 255.0) comp = 255.0
            sum += comp.toLong()
            count++
          }
        }
        if (count <= 0) java.lang.Double.NaN else sum.toDouble() / count.toDouble()
      } else {
        // Luma default
        for (y in startY until (startY + roiH) step yStep) {
          val yRow = y * yRowStride
          for (x in startX until (startX + roiW) step xStep) {
            val v: Int = yBuffer.get(yRow + x * yPixStride).toInt() and 0xFF
            sum += v
            count++
          }
        }
        if (count <= 0) java.lang.Double.NaN else sum.toDouble() / count.toDouble()
      }

      // Push to cross-platform native buffer for JS polling
      if (java.lang.Double.isFinite(resultMean)) {
        try { HeartPyModule.addPPGSample(resultMean) } catch (_: Throwable) {}
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
