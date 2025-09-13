package com.heartpyapp.ppg

import android.media.Image
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry
import java.nio.ByteBuffer

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
      val channel = (params?.get("channel") as? String) ?: "luma"
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

      val useRed = (channel == "red" && planes.size >= 3)
      if (useRed) {
        // V/Cr plane at index 2
        val vPlane = planes[2]
        val vBuffer: ByteBuffer = vPlane.buffer
        val vRowStride = vPlane.rowStride
        val vPixStride = vPlane.pixelStride

        for (y in startY until (startY + roiH) step yStep) {
          val yRow = y * yRowStride
          val vY = y shr 1
          val vRow = vY * vRowStride
          for (x in startX until (startX + roiW) step xStep) {
            val yIdx = yRow + x * yPixStride
            val vX = x shr 1
            val vIdx = vRow + vX * vPixStride
            val Y = (yBuffer.get(yIdx).toInt() and 0xFF).toDouble()
            val V = (vBuffer.get(vIdx).toInt() and 0xFF).toDouble()
            // R ≈ Y + 1.402 * (V - 128)
            var r = Y + 1.402 * (V - 128.0)
            if (r < 0.0) r = 0.0
            if (r > 255.0) r = 255.0
            sum += r.toLong()
            count++
          }
        }
        if (count <= 0) return java.lang.Double.NaN
        val meanR = sum.toDouble() / count.toDouble()
        if (java.lang.Double.isFinite(meanR)) meanR else java.lang.Double.NaN
      } else {
        for (y in startY until (startY + roiH) step yStep) {
          val yRow = y * yRowStride
          for (x in startX until (startX + roiW) step xStep) {
            // Absolute get() does not change buffer position
            val v: Int = yBuffer.get(yRow + x * yPixStride).toInt() and 0xFF
            sum += v
            count++
          }
        }
        if (count <= 0) java.lang.Double.NaN else sum.toDouble() / count.toDouble()
      }
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
